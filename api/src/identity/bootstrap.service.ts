import { Injectable } from '@nestjs/common';
import { MongoService } from '../storage/mongo.service';
import { UsersService } from './users.service';

// First run: with no admin able to sign in, create a pending invitation for the configured email.
@Injectable()
export class BootstrapService {
  constructor(private readonly mongo: MongoService, private readonly users: UsersService) {}

  /** Returns the invitation token, or null when an admin already exists (or the email belongs to a non-admin). */
  async bootstrapAdmin(email: string): Promise<string | null> {
    if ((await this.mongo.users.count({ role: 'admin', disabled: false, passwordHash: { $ne: null } })) > 0) return null;
    let user = await this.users.findByEmail(email);
    if (!user) ({ user } = await this.users.insert({ email, name: 'Administrator', role: 'admin' }, null));
    else if (user.role !== 'admin') return null;
    const token = this.users.issueInvite(user);
    await this.mongo.users.save(user);
    return token;
  }
}
