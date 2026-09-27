import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { PoolService } from './pool.service';
import { DealsService } from './deals.service';
import { DisputesService } from './disputes.service';
import { ReportsService } from './reports.service';
import { SweeperService } from './sweeper.service';
import { DealsController } from './deals.controller';
import { ReportsController } from './reports.controller';

@Module({
  imports: [AgentsModule],
  controllers: [DealsController, ReportsController],
  providers: [PoolService, DealsService, DisputesService, ReportsService, SweeperService],
  exports: [PoolService, DealsService, DisputesService, ReportsService],
})
export class DealsModule {}
