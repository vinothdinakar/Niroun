import { Global, Module } from '@nestjs/common';
import { MongoService } from '../storage/mongo.service';
import { ClockService } from './clock.service';
import { LedgerService } from './ledger.service';
import { AuditService } from './audit.service';
import { MailerService } from './mailer.service';
import { SmsService } from './sms.service';
import { RateLimitService } from './rate-limit.service';
import { NonceService } from './nonce.service';

// Infrastructure every feature module needs. Global, so feature modules don't each re-import it.
@Global()
@Module({
  providers: [ClockService, MongoService, LedgerService, AuditService, MailerService, SmsService, RateLimitService, NonceService],
  exports: [ClockService, MongoService, LedgerService, AuditService, MailerService, SmsService, RateLimitService, NonceService],
})
export class CoreModule {}
