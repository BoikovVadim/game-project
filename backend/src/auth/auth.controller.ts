import { Controller, Get, Post, Body, Query, UseGuards, Request, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(JwtAuthGuard)
  @Get('refresh')
  async refresh(@Request() req: { user: { id: number } }) {
    return this.authService.refresh(req.user.id);
  }

  @Post('register')
  async register(
    @Body() body: { username: string; email: string; password: string; referralCode?: string },
  ) {
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

  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) {
    return this.authService.forgotPassword(body?.email ?? '');
  }

  @Post('reset-password')
  async resetPassword(@Body() body: { token: string; newPassword: string }) {
    return this.authService.resetPassword(body?.token ?? '', body?.newPassword ?? '');
  }

  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    try {
      return await this.authService.login(body?.email ?? '', body?.password ?? '');
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[Auth] Login error:', msg, e);
      throw new InternalServerErrorException({ error: msg });
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(
    @Body() body: { email: string; oldPassword: string; newPassword: string },
    @Request() req: any
  ) {
    return this.authService.changePassword(body.email, body.oldPassword, body.newPassword);
  }
}