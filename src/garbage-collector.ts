/**
 * Garbage Collector for Web Search MCP
 * 
 * Automatically detects and cleans up zombie Chrome processes 
 * that weren't properly terminated.
 */

import { exec, execSync } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GCConfig {
    /** How often to run garbage collection (ms). Default: 5 minutes */
    intervalMs: number;
    /** Max age of a Chrome process before it's considered orphaned (ms). Default: 30 minutes */
    maxProcessAgeMs: number;
    /** Enable verbose logging */
    verbose: boolean;
}

const DEFAULT_CONFIG: GCConfig = {
    intervalMs: 5 * 60 * 1000,      // 5 minutes
    maxProcessAgeMs: 30 * 60 * 1000, // 30 minutes
    verbose: process.env.GC_VERBOSE === 'true',
};

interface ProcessInfo {
    pid: number;
    etime: number; // elapsed time in seconds
    cmd: string;
}

export class GarbageCollector {
    private config: GCConfig;
    private intervalHandle: NodeJS.Timeout | null = null;
    private myPid: number;
    private startTime: number;

    constructor(config: Partial<GCConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.myPid = process.pid;
        this.startTime = Date.now();
    }

    /**
     * Start periodic garbage collection
     */
    start(): void {
        if (this.intervalHandle) {
            console.error('[GC] Already running');
            return;
        }

        console.error(`[GC] Starting garbage collector (interval: ${this.config.intervalMs / 1000}s, maxAge: ${this.config.maxProcessAgeMs / 1000}s)`);

        // Run immediately on start
        this.runGC().catch(err => console.error('[GC] Initial sweep failed:', err));

        // Then run periodically
        this.intervalHandle = setInterval(() => {
            this.runGC().catch(err => console.error('[GC] Periodic sweep failed:', err));
        }, this.config.intervalMs);

        // Don't keep the process alive just for GC
        this.intervalHandle.unref();
    }

    /**
     * Stop periodic garbage collection
     */
    stop(): void {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
            console.error('[GC] Stopped');
        }
    }

    /**
     * Run a garbage collection sweep
     */
    async runGC(): Promise<{ killed: number; checked: number }> {
        try {
            const chromeProcesses = await this.findChromeProcesses();

            if (this.config.verbose) {
                console.error(`[GC] Found ${chromeProcesses.length} Chrome processes`);
            }

            let killed = 0;
            const maxAgeSeconds = this.config.maxProcessAgeMs / 1000;

            for (const proc of chromeProcesses) {
                // Skip if process is younger than threshold
                if (proc.etime < maxAgeSeconds) {
                    continue;
                }

                // Skip if it's our own process
                if (proc.pid === this.myPid) {
                    continue;
                }

                // Check if process looks like a zombie (very old Chrome process)
                if (await this.isOrphanedChrome(proc)) {
                    if (this.config.verbose) {
                        console.error(`[GC] Killing orphaned Chrome process ${proc.pid} (age: ${Math.round(proc.etime / 60)}min)`);
                    }

                    await this.killProcess(proc.pid);
                    killed++;
                }
            }

            if (killed > 0) {
                console.error(`[GC] Swept ${killed} orphaned Chrome processes`);
            }

            return { killed, checked: chromeProcesses.length };
        } catch (error) {
            console.error('[GC] Sweep error:', error);
            return { killed: 0, checked: 0 };
        }
    }

    /**
     * Find all Chrome/Chromium processes with their elapsed time
     */
    private async findChromeProcesses(): Promise<ProcessInfo[]> {
        try {
            // Get Chrome processes with PID, elapsed time, and command
            // etime format: [[dd-]hh:]mm:ss
            const { stdout } = await execAsync(
                `ps -eo pid,etimes,cmd 2>/dev/null | grep -E "(chrome|chromium)" | grep -v grep || true`
            );

            if (!stdout.trim()) {
                return [];
            }

            const processes: ProcessInfo[] = [];
            const lines = stdout.trim().split('\n');

            for (const line of lines) {
                const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
                if (match) {
                    processes.push({
                        pid: parseInt(match[1], 10),
                        etime: parseInt(match[2], 10), // etimes gives seconds directly
                        cmd: match[3],
                    });
                }
            }

            return processes;
        } catch {
            return [];
        }
    }

    /**
     * Check if a Chrome process is orphaned (not a child of any known web-search-mcp)
     */
    private async isOrphanedChrome(proc: ProcessInfo): Promise<boolean> {
        // Check if this is a playwright-controlled Chrome
        if (!proc.cmd.includes('playwright') && !proc.cmd.includes('user-data-dir=/tmp/playwright')) {
            return false; // Not a Playwright Chrome, don't touch it
        }

        // If it's a Playwright Chrome that's very old, it's likely orphaned
        // Chrome instances from proper shutdowns should be gone quickly
        const ageMinutes = proc.etime / 60;

        // Anything older than max age is considered orphaned
        return ageMinutes > (this.config.maxProcessAgeMs / 60000);
    }

    /**
     * Kill a process and its children
     */
    private async killProcess(pid: number): Promise<void> {
        try {
            // Use SIGTERM first for graceful shutdown
            process.kill(pid, 'SIGTERM');

            // Wait a bit, then force kill if still alive
            await new Promise(resolve => setTimeout(resolve, 1000));

            try {
                process.kill(pid, 0); // Check if still alive
                // Still alive, force kill
                process.kill(pid, 'SIGKILL');
            } catch {
                // Process is gone, good
            }
        } catch (error: unknown) {
            // Process might already be dead
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
                console.error(`[GC] Failed to kill process ${pid}:`, error);
            }
        }
    }

    /**
     * Kill ALL Chrome processes started by Playwright (emergency cleanup)
     * Use with caution - this is aggressive
     */
    async killAllPlaywrightChromes(): Promise<number> {
        try {
            const { stdout } = await execAsync(
                `pgrep -f "playwright" 2>/dev/null || true`
            );

            if (!stdout.trim()) {
                return 0;
            }

            const pids = stdout.trim().split('\n').map(p => parseInt(p, 10)).filter(p => !isNaN(p) && p !== this.myPid);

            for (const pid of pids) {
                await this.killProcess(pid);
            }

            console.error(`[GC] Emergency cleanup: killed ${pids.length} Playwright processes`);
            return pids.length;
        } catch {
            return 0;
        }
    }

    /**
     * Get current memory and process stats
     */
    getStats(): { chromeCount: number; memoryMB: number; uptimeMinutes: number } {
        let chromeCount = 0;
        try {
            const result = execSync(`pgrep -c -f "chrome" 2>/dev/null || echo 0`, { encoding: 'utf-8' });
            chromeCount = parseInt(result.trim(), 10) || 0;
        } catch {
            // Ignore
        }

        const memUsage = process.memoryUsage();
        const memoryMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        const uptimeMinutes = Math.round((Date.now() - this.startTime) / 60000);

        return { chromeCount, memoryMB, uptimeMinutes };
    }
}

// Singleton instance for global access
let globalGC: GarbageCollector | null = null;

export function getGarbageCollector(config?: Partial<GCConfig>): GarbageCollector {
    if (!globalGC) {
        globalGC = new GarbageCollector(config);
    }
    return globalGC;
}

export function startGarbageCollector(config?: Partial<GCConfig>): GarbageCollector {
    const gc = getGarbageCollector(config);
    gc.start();
    return gc;
}
