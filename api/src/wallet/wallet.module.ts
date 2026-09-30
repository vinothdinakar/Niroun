import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { WalletController, StripeWebhookController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [IdentityModule],
  controllers: [WalletController, StripeWebhookController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
