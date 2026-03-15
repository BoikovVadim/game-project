import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { getRequiredEnv } from '../common/env';
import {
  type AuthJwtPayload,
  type AuthenticatedRequestUser,
} from './auth-session.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getRequiredEnv('JWT_SECRET'),
    });
  }

  async validate(payload: AuthJwtPayload): Promise<AuthenticatedRequestUser> {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
      select: ['id', 'username', 'isAdmin'],
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const impersonation = payload.impersonation ?? null;
    if (impersonation) {
      const actor = await this.userRepository.findOne({
        where: { id: impersonation.actorId },
        select: ['id', 'username', 'isAdmin'],
      });
      if (!actor?.isAdmin) {
        throw new UnauthorizedException('Impersonation actor is invalid');
      }
      if (
        actor.username !== impersonation.actorUsername ||
        user.id !== impersonation.targetUserId
      ) {
        throw new UnauthorizedException('Impersonation scope is invalid');
      }
    }

    return {
      id: user.id,
      username: user.username,
      isAdmin: !!user.isAdmin,
      isImpersonating: !!impersonation,
      impersonation,
    };
  }
}
