import { Controller, Get, Post, Body, Query, UseGuards, Request, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ResendCodeDto, VerifyCodeDto } from './dto/auth-write.dto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/reset-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(JwtAuthGuard)
  @Get('refresh')
  async refresh(@Request() req: { user: { id: number } }) {
    return this.authService.refresh(req.user.id);
  }

  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @Post('register')
  async register(@Body() body: RegisterDto) {
    return this.authService.register(
      body.username,
      body.email,
      body.password,
      body.referralCode,
    );
  }

  @Get('verify-email')
  async verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token ?? '');
  }

  @Throttle({ short: { ttl: 60000, limit: 10 } })
  @Post('verify-code')
  async verifyCode(@Body() body: VerifyCodeDto) {
    return this.authService.verifyCode(body.email, body.code);
  }

  @Throttle({ short: { ttl: 60000, limit: 3 } })
  @Post('resend-code')
  async resendCode(@Body() body: ResendCodeDto) {
    return this.authService.resendCode(body.email);
  }

  @Throttle({ short: { ttl: 60000, limit: 3 } })
  @Post('forgot-password')
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.forgotPassword(body?.email ?? '');
  }

  @Post('reset-password')
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body?.token ?? '', body?.newPassword ?? '');
  }

  @Throttle({ short: { ttl: 60000, limit: 10 } })
  @Post('login')
  async login(@Body() body: LoginDto) {
    try {
      const identifier = body?.identifier ?? body?.email ?? '';
      return await this.authService.login(identifier, body?.password ?? '');
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[Auth] Login error:', msg, e);
      throw new InternalServerErrorException({ error: 'Login failed' });
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(
    @Body() body: ChangePasswordDto,
    @Request() req: { user: { id: number } }
  ) {
    return this.authService.changePassword(req.user.id, body.oldPassword, body.newPassword);
  }
}