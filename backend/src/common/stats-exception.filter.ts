import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { buildEmptyUserStatsDto } from '../users/dto/users-read.dto';

const EMPTY_STATS = buildEmptyUserStatsDto();

@Catch()
export class StatsExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(StatsExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (response.headersSent) return;

    const path = request.url?.split('?')[0] ?? '';
    if (path === '/users/stats' || path.endsWith('/users/stats')) {
      this.logger.warn(`Stats endpoint error: ${String(exception)}`);
      response.status(HttpStatus.OK).json(EMPTY_STATS);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response
        .status(status)
        .json(
          typeof body === 'string'
            ? { statusCode: status, message: body }
            : body,
        );
      return;
    }

    const stack =
      exception instanceof Error ? exception.stack : String(exception);
    this.logger.error(
      `Unhandled exception on ${request.method} ${request.url}: ${stack}`,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Internal server error',
    });
  }
}
