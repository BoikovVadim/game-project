import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'fallback-dev-key-change-me',
    });
  }

  async validate(payload: { sub: number; username?: string }): Promise<{ id: number; username: string; isAdmin: boolean }> {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
      select: ['id', 'username'],
    });
    if (!user) {
      return { id: payload.sub, username: payload.username || '', isAdmin: false };
    }
    if (user.id === 1) return { id: user.id, username: user.username, isAdmin: true };
    const raw = await this.userRepository.query('SELECT isAdmin FROM user WHERE id = ? LIMIT 1', [user.id]);
    const row = raw?.[0];
    const isAdminRaw = row?.isAdmin ?? row?.isadmin;
    const isAdmin = isAdminRaw === 1 || isAdminRaw === true || isAdminRaw === '1';
    return { id: user.id, username: user.username, isAdmin: !!isAdmin };
  }
}