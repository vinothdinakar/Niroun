import { Module } from '@nestjs/common';
import { OrgsService } from './orgs.service';
import { SessionsService } from './sessions.service';
import { UsersService } from './users.service';
import { MfaService } from './mfa.service';
import { AuthService } from './auth.service';
import { SignupService } from './signup.service';
import { EnrollmentsService } from './enrollments.service';
import { BootstrapService } from './bootstrap.service';
import { AuthController } from './auth.controller';
import { SignupController } from './signup.controller';

// Who people are: companies, users, sessions, two-factor, sign-in, signup, and agent enrolment codes.
@Module({
  controllers: [AuthController, SignupController],
  providers: [OrgsService, SessionsService, UsersService, MfaService, AuthService, SignupService, EnrollmentsService, BootstrapService],
  exports: [OrgsService, SessionsService, UsersService, MfaService, AuthService, SignupService, EnrollmentsService, BootstrapService],
})
export class IdentityModule {}
