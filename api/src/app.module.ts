import { DynamicModule, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { BondOptions } from './config/options';
import { OptionsModule } from './config/options.module';
import { CoreModule } from './core/core.module';
import { IdentityModule } from './identity/identity.module';
import { AgentsModule } from './agents/agents.module';
import { DealsModule } from './deals/deals.module';
import { ConsoleModule } from './console/console.module';
import { WalletModule } from './wallet/wallet.module';
import { HealthController } from './health.controller';
import { AuthGuard } from './common/auth.guard';
import { AllExceptionsFilter } from './common/exception.filter';
import { EdgeMiddleware } from './common/edge.middleware';

@Module({})
export class AppModule implements NestModule {
  static register(options: BondOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [OptionsModule.forRoot(options), CoreModule, IdentityModule, AgentsModule, DealsModule, ConsoleModule, WalletModule],
      controllers: [HealthController],
      providers: [
        { provide: APP_GUARD, useClass: AuthGuard }, // every route is authenticated (or explicitly @Access('public'))
        { provide: APP_FILTER, useClass: AllExceptionsFilter }, // one error format
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(EdgeMiddleware).forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
