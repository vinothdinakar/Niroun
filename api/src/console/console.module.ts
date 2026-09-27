import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { AgentsModule } from '../agents/agents.module';
import { DealsModule } from '../deals/deals.module';
import { ConsoleController } from './console.controller';

@Module({
  imports: [IdentityModule, AgentsModule, DealsModule],
  controllers: [ConsoleController],
})
export class ConsoleModule {}
