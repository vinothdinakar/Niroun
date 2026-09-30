import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { Access, CurrentUser, RequirePermission } from '../common/decorators';
import { HttpError } from '../common/http-error';
import { BondRequest } from '../common/request';
import { User } from '../storage/db.types';
import { WalletService } from './wallet.service';
import { StripeGateway } from './stripe.gateway';
import { Inject } from '@nestjs/common';
import { BOND_OPTIONS, BondOptions } from '../config/options';

type Json = Record<string, unknown>;

// The organization wallet, as the customer console uses it. Reading is open to everyone in the organization (owners and
// viewers alike); moving money needs `wallet_manage`, which only the organization owner holds. Every route is scoped to
// the signed-in person's own organization: there is no way to name another.
@Controller('v1/console/wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  summary(@CurrentUser() user: User) {
    return this.wallet.summary(user);
  }

  @Get('transactions')
  transactions(@CurrentUser() user: User, @Query() q: Record<string, string>) {
    return this.wallet.list(user, q);
  }

  @Post('deposits')
  @RequirePermission('wallet_manage')
  deposit(@CurrentUser() user: User, @Body() body: Json) {
    return this.wallet.createDeposit(user, body);
  }

  /** Called when the person comes back from Stripe, so their deposit shows up without waiting for the webhook. */
  @Post('deposits/:id/sync')
  @RequirePermission('wallet_manage')
  @HttpCode(200)
  async sync(@CurrentUser() user: User, @Param('id') id: string) {
    return { transaction: await this.wallet.syncDeposit(user, id) };
  }

  @Post('payouts/setup')
  @RequirePermission('wallet_manage')
  @HttpCode(200)
  setupPayouts(@CurrentUser() user: User) {
    return this.wallet.startPayoutSetup(user);
  }

  @Post('withdrawals')
  @RequirePermission('wallet_manage')
  async withdraw(@CurrentUser() user: User, @Body() body: Json) {
    return { transaction: await this.wallet.withdraw(user, body) };
  }
}

// Where Stripe tells us what happened (a payment arrived, a payout landed or failed). Nobody is signed in: the call is
// trusted only because its signature, made with a secret only Stripe and we hold, matches the exact bytes received.
@Controller('v1/stripe')
export class StripeWebhookController {
  constructor(private readonly wallet: WalletService, @Inject(BOND_OPTIONS) private readonly options: BondOptions) {}

  @Post('webhook')
  @Access('public')
  @HttpCode(200)
  async webhook(@Req() req: BondRequest): Promise<Json> {
    const gateway: StripeGateway | undefined = this.options.stripe;
    if (!gateway) throw new HttpError(503, 'WALLET_UNAVAILABLE', 'Payments are not set up on this server');
    const signature = req.headers['stripe-signature'];
    let event;
    try {
      event = gateway.constructEvent(req.rawBody ?? '', Array.isArray(signature) ? signature[0] : signature ?? '');
    } catch {
      throw new HttpError(400, 'INVALID_SIGNATURE', 'The signature does not match');
    }
    await this.wallet.handleEvent(event);
    return { received: true };
  }
}
