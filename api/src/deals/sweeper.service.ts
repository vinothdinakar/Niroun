import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BOND_OPTIONS, BondOptions } from '../config/options';
import { DealsService } from './deals.service';

// Runs the expiry sweep on a timer: cancels stale proposals, auto-settles silent buyers, expires unclaimed coverage.
// Off by default (tests call sweep() themselves); main.ts turns it on.
@Injectable()
export class SweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Sweeper');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deals: DealsService, @Inject(BOND_OPTIONS) private readonly options: BondOptions) {}

  onModuleInit(): void {
    if (this.options.sweepIntervalMs > 0) {
      this.timer = setInterval(() => void this.tick(), this.options.sweepIntervalMs);
      this.timer.unref?.();
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return; // never overlap two sweeps
    this.running = true;
    try {
      await this.deals.sweep();
    } catch (e) {
      this.log.error(`sweep failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
