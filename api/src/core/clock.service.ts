import { Inject, Injectable } from '@nestjs/common';
import { BOND_OPTIONS, BondOptions } from '../config/options';

// Every "what time is it" goes through here, so tests and the demo can run on a virtual clock.
@Injectable()
export class ClockService {
  constructor(@Inject(BOND_OPTIONS) private readonly options: BondOptions) {}

  now(): number {
    return this.options.clock.now();
  }
}
