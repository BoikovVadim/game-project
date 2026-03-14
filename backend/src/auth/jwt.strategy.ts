import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { getRequiredEnv } from '../common/env';

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

  async validate(payload: { sub: number; username?: string }): Promise<{ id: number; username: string; isAdmin: boolean }> {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
      select: ['id', 'username', 'isAdmin'],
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return { id: user.id, username: user.username, isAdmin: !!user.isAdmin };
  }
}