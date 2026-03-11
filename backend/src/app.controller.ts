import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { join, resolve } from 'path';
import * as fs from 'fs';

// Абсолютный путь к SPA (из backend/dist -> корень проекта -> Frontend/build)
const INDEX_PATH = resolve(join(__dirname, '..', '..', 'Frontend', 'build', 'index.html'));
const LAST_REBUILD_PATH = resolve(join(__dirname, '..', '..', '.last-rebuild'));

function sendIndex(res: Response): void {
  if (!fs.existsSync(INDEX_PATH)) {
    res.status(503).type('text/html').send(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Frontend не собран</title></head><body style="font-family:sans-serif;padding:2rem;max-width:600px">' +
      '<h1>Frontend не собран</h1><p>Соберите фронтенд или запустите в режиме разработки:</p>' +
      '<ul><li><strong>Разработка:</strong> из корня проекта: <code>npm run dev:live</code>, затем откройте <a href="http://localhost:3000">http://localhost:3000</a></li>' +
      '<li><strong>Один сервер:</strong> <code>npm run start:simple</code> (сначала соберёт фронт и бэк)</li></ul></body></html>',
    );
    return;
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(INDEX_PATH, (err) => {
    if (err && !res.headersSent) {
      res.status(500).type('text/plain').send('Ошибка отдачи index.html');
    }
  });
}

/** SPA: для всех страниц приложения отдаём index.html (API — в других контроллерах). */
@Controller()
export class AppController {
  @Get()
  serveRoot(@Res() res: Response) {
    sendIndex(res);
  }

  @Get('login')
  serveLogin(@Res() res: Response) {
    sendIndex(res);
  }

  @Get('register')
  serveRegister(@Res() res: Response) {
    sendIndex(res);
  }

  @Get('profile')
  serveProfile(@Res() res: Response) {
    sendIndex(res);
  }

  @Get('admin')
  serveAdmin(@Res() res: Response) {
    sendIndex(res);
  }

  @Get('support')
  serveSupport(@Res() res: Response) {
    sendIndex(res);
  }

  @Get('forgot-password')
  serveForgotPassword(@Res() res: Response) {
    sendIndex(res);
  }

  @Get('reset-password')
  serveResetPassword(@Res() res: Response) {
    sendIndex(res);
  }

  @Get('verify-email')
  serveVerifyEmail(@Res() res: Response) {
    sendIndex(res);
  }

  @Get('api/last-rebuild')
  getLastRebuild(@Res() res: Response) {
    try {
      const ts = fs.readFileSync(LAST_REBUILD_PATH, 'utf8').trim();
      res.type('text/plain').send(ts);
    } catch {
      res.type('text/plain').send('0');
    }
  }
}
