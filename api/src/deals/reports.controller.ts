import { Controller, Get } from '@nestjs/common';
import { Access, CallerScope, RequirePermission } from '../common/decorators';
import { Scope } from '../common/scope';
import { CustomerOverview, PlatformStats, ReportsService } from './reports.service';

// Numbers for dashboards.
@Controller('v1')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Pool health and platform totals. Staff only. */
  @Get('stats')
  @Access('user')
  @RequirePermission('stats')
  stats(): Promise<PlatformStats> {
    return this.reports.stats();
  }

  /** What the caller can see about their own agents. Available to every signed-in person. */
  @Get('console/overview')
  @Access('user')
  overview(@CallerScope() scope: Scope): Promise<CustomerOverview> {
    return this.reports.overview(scope);
  }
}
