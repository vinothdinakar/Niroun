import { DynamicModule, Global, Module } from '@nestjs/common';
import { BOND_OPTIONS, BondOptions } from './options';

// Makes the resolved BondOptions injectable everywhere (@Inject(BOND_OPTIONS)).
@Global()
@Module({})
export class OptionsModule {
  static forRoot(options: BondOptions): DynamicModule {
    return { module: OptionsModule, providers: [{ provide: BOND_OPTIONS, useValue: options }], exports: [BOND_OPTIONS] };
  }
}
