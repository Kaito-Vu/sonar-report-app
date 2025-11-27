import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { LoggingInterceptor } from './logging.interceptor';

// Dùng require để import hbs (tránh lỗi TypeScript 'registerHelper is not a function')
const hbs = require('hbs');

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 1. Setup Logger & Interceptor
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  app.useGlobalInterceptors(new LoggingInterceptor());

  // 2. Setup Static Assets (CSS, JS, Fonts)
  // Sử dụng process.cwd() để đảm bảo đường dẫn đúng cả khi chạy dev lẫn prod (dist)
  app.useStaticAssets(join(process.cwd(), 'public'));

  // 3. Setup View Engine (Handlebars)
  app.setBaseViewsDir(join(process.cwd(), 'views'));
  app.setViewEngine('hbs');

  // 4. Đăng ký Partials (Thư mục con chứa các file .hbs tái sử dụng)
  hbs.registerPartials(join(process.cwd(), 'views', 'partials'));

  // 5. Đăng ký Helpers
  // Helper so sánh bằng: {{#if (eq a b)}}
  hbs.registerHelper('eq', function (a, b) {
    return a === b;
  });

  // Helper debug dữ liệu: {{json object}}
  hbs.registerHelper('json', function (context) {
    return JSON.stringify(context);
  });

  await app.listen(3000);
  console.log(`Application is running on: http://localhost:3000`);
}
bootstrap();