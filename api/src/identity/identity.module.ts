import { Module } from '@nestjs/common';
import { OrgsService } from './orgs.service';
import { SessionsService } from './sessions.service';
import { UsersService } from './users.service';
import { MfaService } from './mfa.service';
import { AuthService } from './auth.service';
import { SignupService } from './signup.service';
import { EnrollmentsService } from './enrollments.service';
import { BootstrapService } from './bootstrap.service';
import { VerificationRequestsService } from './verification-requests.service';
import { AuthController } from './auth.controller';
import { SignupController } from './signup.controller';

// Who people are: companies, users, sessions, two-factor, sign-in, signup, agent enrolment codes, and KYB/KYC applications.
@Module({
  controllers: [AuthController, SignupController],
  providers: [OrgsService, SessionsService, UsersService, MfaService, AuthService, SignupService, EnrollmentsService, BootstrapService, VerificationRequestsService],
  exports: [OrgsService, SessionsService, UsersService, MfaService, AuthService, SignupService, EnrollmentsService, BootstrapService, VerificationRequestsService],
})
export class IdentityModule {}
