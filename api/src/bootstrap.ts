import 'reflect-metadata';
import type { Server } from 'node:http';
import { LogLevel, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { BondOptions, resolveOptions } from './config/options';
import { MailerService } from './core/mailer.service';
import { SmsService } from './core/sms.service';
import { MongoService } from './storage/mongo.service';
import { took } from './startup';
import { AgentsService } from './agents/agents.service';
import { DealsService } from './deals/deals.service';
import { ReportsService } from './deals/reports.service';
import { BootstrapService } from './identity/bootstrap.service';
import { EnrollmentsService } from './identity/enrollments.service';
import { OrgsService } from './identity/orgs.service';
import { UsersService } from './identity/users.service';
import { VerificationDocumentsService } from './identity/verification-documents.service';

/**
 * A running Bond API plus handles for programmatic use: `main.ts` starts one from the environment, and the
 * demo and the tests start their own (with a virtual clock and a throwaway database) and seed it through
 * `accounts` / `engine` without going over HTTP. `mongo` gives direct access to the database, for inspection.
 */
export interface BondApp {
  nest: NestExpressApplication;
  server: Server;
  options: BondOptions;
  mongo: MongoService;
  mailer: MailerService;
  sms: SmsService;
  accounts: {
    createUser: UsersService['createUser'];
    findByEmail: UsersService['findByEmail'];
    createOrg: OrgsService['create'];
    listOrgs: OrgsService['list'];
    createEnrollment: EnrollmentsService['create'];
    bootstrapAdmin: BootstrapService['bootstrapAdmin'];
  };
  engine: {
    setVerification: AgentsService['setVerification'];
    listAgents: AgentsService['list'];
    sweep: DealsService['sweep'];
    stats: ReportsService['stats'];
    purgeDocuments: VerificationDocumentsService['purgeExpired'];
  };
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

export async function createApp(
  partial: Partial<BondOptions> & { keyFile?: string | null } = {},
  runtime: { logger?: LogLevel[] | false; shutdownHooks?: boolean } = {},
): Promise<BondApp> {
  const options = resolveOptions(partial);
  // Phase timings are for the real server (main.ts asks for 'log'); tests and the demo start many apps and stay quiet.
  const say = Array.isArray(runtime.logger) && runtime.logger.includes('log') ? (m: string) => new Logger('Startup').log(m) : () => undefined;
  const t0 = Date.now();
  say('loading modules (building the dependency graph)');
  const nest = await NestFactory.create<NestExpressApplication>(AppModule.register(options), {
    bodyParser: false, // EdgeMiddleware reads the body itself: agent signatures cover the exact bytes
    logger: runtime.logger ?? ['error', 'warn'],
  });
  say(`modules loaded in ${took(Date.now() - t0)}`);
  nest.disable('x-powered-by');
  if (runtime.shutdownHooks) nest.enableShutdownHooks(); // close the database connection on SIGINT/SIGTERM
  const t1 = Date.now();
  say('initializing (this connects to MongoDB and prepares the database)');
  await nest.init();
  say(`initialized in ${took(Date.now() - t1)}`);

  const users = nest.get(UsersService);
  const orgs = nest.get(OrgsService);
  const agents = nest.get(AgentsService);
  const deals = nest.get(DealsService);
  const reports = nest.get(ReportsService);
  const enrollments = nest.get(EnrollmentsService);
  const bootstrap = nest.get(BootstrapService);
  const documents = nest.get(VerificationDocumentsService);

  return {
    nest,
    server: nest.getHttpServer(),
    options,
    mongo: nest.get(MongoService),
    mailer: nest.get(MailerService),
    sms: nest.get(SmsService),
    accounts: {
      createUser: users.createUser.bind(users),
      findByEmail: users.findByEmail.bind(users),
      createOrg: orgs.create.bind(orgs),
      listOrgs: orgs.list.bind(orgs),
      createEnrollment: enrollments.create.bind(enrollments),
      bootstrapAdmin: bootstrap.bootstrapAdmin.bind(bootstrap),
    },
    engine: {
      setVerification: agents.setVerification.bind(agents),
      listAgents: agents.list.bind(agents),
      sweep: deals.sweep.bind(deals),
      stats: reports.stats.bind(reports),
      purgeDocuments: documents.purgeExpired.bind(documents),
    },
    async listen(port = 4100) {
      await nest.listen(port);
      const address = nest.getHttpServer().address();
      const actual = typeof address === 'object' && address ? address.port : port;
      options.publicUrl ??= `http://localhost:${actual}`; // tests; a real deployment sets BOND_PUBLIC_URL to the dashboard
      return actual;
    },
    close: () => nest.close(),
  };
}
