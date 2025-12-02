import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { LoggingInterceptor } from './logging.interceptor';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const hbs = require('hbs');

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Cấu hình Static Assets & View
  app.useStaticAssets(join(process.cwd(), 'public'));
  app.setBaseViewsDir(join(process.cwd(), 'views'));
  app.setViewEngine('hbs');

  // Đăng ký Partials
  hbs.registerPartials(join(process.cwd(), 'views', 'partials'));

  // === ĐĂNG KÝ HELPERS (FIX LỖI CỦA BẠN TẠI ĐÂY) ===

  // Helper so sánh bằng: {{#if (eq a b)}}
  hbs.registerHelper('eq', function (a, b) {
    return a === b;
  });

  // Helper so sánh lớn hơn: {{#if (gt a b)}}
  hbs.registerHelper('gt', function (a, b) {
    return a > b;
  });

  // Helper so sánh nhỏ hơn: {{#if (lt a b)}}
  hbs.registerHelper('lt', function (a, b) {
    return a < b;
  });

  // Helper logic AND: {{#if (and a b)}}
  hbs.registerHelper('and', function (a, b) {
    return a && b;
  });

  // Helper debug JSON
  hbs.registerHelper('json', function (context) {
    return JSON.stringify(context);
  });

  await app.listen(3000);
  console.log(`Application is running on: http://localhost:3000`);
}
void bootstrap();
