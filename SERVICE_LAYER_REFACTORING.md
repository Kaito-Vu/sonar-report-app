# Service Layer Refactoring - Business Logic Separation

Tài liệu này mô tả việc refactor để tách business logic khỏi controllers và đưa vào service layer.

## 🎯 Mục tiêu

- **Tách biệt concerns**: Controller chỉ xử lý HTTP, Service xử lý business logic
- **Tái sử dụng code**: Business logic có thể được dùng ở nhiều nơi
- **Dễ test**: Service có thể test độc lập không cần HTTP layer
- **Maintainability**: Code dễ maintain và mở rộng hơn

## 📁 Cấu trúc mới

### Services đã tạo

1. **`ProjectService`** (`src/services/project.service.ts`)
   - Quản lý tất cả business logic liên quan đến Project
   - Extends `BaseService` để có logging và error handling

2. **`ReportService`** (`src/services/report.service.ts`)
   - Quản lý business logic liên quan đến Report
   - Xử lý pagination, sorting, filtering

3. **`SettingsService`** (`src/services/settings.service.ts`)
   - Quản lý SonarQube settings
   - Xử lý validation và normalization

## 🔄 Thay đổi chi tiết

### 1. ProjectService

#### Methods:
- `getDashboardProjects()` - Lấy projects với last scan info
- `getAllProjects()` - Lấy tất cả projects
- `getProjectById(id)` - Lấy project theo ID
- `createProject(dto)` - Tạo project mới
- `deleteProject(id)` - Xóa project với transaction
- `getProjectWithHistory(id)` - Lấy project với scan history từ SonarQube

#### Before (Controller):
```typescript
async home() {
  const projects = await this.prisma.project.findMany({
    orderBy: { name: 'asc' },
    include: {
      reports: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        where: { status: { not: 'DELETED' } },
      },
    },
  });

  const projectsView = projects.map((p) => ({
    id: p.id,
    name: p.name,
    key: p.key,
    lastScan: p.reports[0]
      ? DateUtil.formatToVietnamese(...)
      : 'Chưa có',
    lastStatus: p.reports[0] ? p.reports[0].status : null,
  }));
  return { projects: projectsView };
}
```

#### After (Controller):
```typescript
async home() {
  const projects = await this.projectService.getDashboardProjects();
  return { projects };
}
```

**Lợi ích:**
- ✅ Controller ngắn gọn, dễ đọc
- ✅ Business logic có thể tái sử dụng
- ✅ Dễ test service riêng biệt
- ✅ Consistent error handling

---

### 2. ReportService

#### Methods:
- `getReportDetails(id, options)` - Lấy report với paginated issues
- `softDeleteReport(id)` - Soft delete report
- `buildOrderBy(sortBy, sortOrder)` - Private method để build orderBy clause

#### Before (Controller):
```typescript
async viewReport(@Param('id') id: string, ...) {
  page = Math.max(1, page);
  pageSize = Math.max(10, Math.min(pageSize, 500));

  const report = await this.prisma.report.findUnique({...});
  if (!report) return { error: 'Report not found' };

  const stats = await this.statisticsService.getStatistics(id);

  let orderBy: any = {};
  if (sortBy === 'default') {
    orderBy = [{ typeIdx: 'asc' }, ...];
  } else if (sortBy === 'severity') {
    orderBy = { severityIdx: sortOrder };
  }
  // ... 30+ lines more
}
```

#### After (Controller):
```typescript
async viewReport(@Param('id') id: string, ...) {
  try {
    return await this.reportService.getReportDetails(id, {
      page,
      pageSize,
      sortBy,
      sortOrder,
    });
  } catch (error) {
    return { error: 'Report not found' };
  }
}
```

**Lợi ích:**
- ✅ Giảm từ ~50 dòng xuống ~10 dòng
- ✅ Logic sorting tách riêng, dễ maintain
- ✅ Có thể reuse cho API endpoints khác

---

### 3. SettingsService

#### Methods:
- `getSettings()` - Lấy SonarQube settings
- `updateSettings(dto)` - Update settings với validation

#### Before (Controller):
```typescript
async saveSettings(@Body() body: SettingsDto, @Res() res: Response) {
  try {
    await this.prisma.sonarConfig.deleteMany();
    await this.prisma.sonarConfig.create({
      data: {
        url: body.url.replace(/\/$/, ''),
        token: body.token,
      },
    });
    return res.redirect('/settings?saved=1');
  } catch (error) {
    return res.redirect('/settings?error=1');
  }
}
```

#### After (Controller):
```typescript
async saveSettings(@Body() body: SettingsDto, @Res() res: Response) {
  try {
    await this.settingsService.updateSettings(body);
    return ResponseUtil.redirect(res, '/settings?saved=1');
  } catch (error) {
    return ResponseUtil.redirect(res, '/settings?error=1');
  }
}
```

**Lợi ích:**
- ✅ URL normalization logic tách riêng
- ✅ Có thể reuse cho API endpoints
- ✅ Dễ test validation logic

---

## 📊 So sánh Before/After

### Controller Size Reduction

| Controller | Before | After | Reduction |
|------------|--------|-------|-----------|
| `ReportController` | ~424 lines | ~200 lines | **53%** |
| `ProjectController` | ~74 lines | ~50 lines | **32%** |

### Code Organization

**Before:**
- Business logic trộn lẫn với HTTP handling
- Khó test business logic
- Code duplication giữa các controllers

**After:**
- Business logic tách riêng trong services
- Dễ test từng service độc lập
- Code reuse tốt hơn

---

## 🧪 Testing Benefits

### Before:
```typescript
// Phải test qua HTTP layer
const response = await request(app.getHttpServer())
  .get('/')
  .expect(200);
```

### After:
```typescript
// Test service trực tiếp
const projects = await projectService.getDashboardProjects();
expect(projects).toHaveLength(5);
expect(projects[0]).toHaveProperty('lastScan');
```

**Lợi ích:**
- ✅ Test nhanh hơn (không cần HTTP layer)
- ✅ Test đơn giản hơn (không cần mock HTTP)
- ✅ Test coverage tốt hơn

---

## 🔧 Best Practices Áp dụng

### 1. Single Responsibility Principle
- Controller: Chỉ xử lý HTTP requests/responses
- Service: Chỉ xử lý business logic

### 2. Dependency Injection
- Services được inject vào controllers
- Dễ mock cho testing

### 3. Error Handling
- Services throw exceptions
- Controllers catch và format response

### 4. Logging
- Services extend `BaseService` có logging tự động
- Consistent logging pattern

---

## 📝 Interface Definitions

### ProjectService Interfaces

```typescript
interface ProjectWithLastScan {
  id: number;
  name: string;
  key: string;
  lastScan: string;
  lastStatus: string | null;
}

interface ProjectHistoryItem {
  analysisKey: string;
  date: string;
  rawDate: string | Date;
  version: string;
  isSynced: boolean;
  localReportId: string | null;
  status: string;
  filename: string | null;
  timestamp: number;
  isLatest?: boolean;
}
```

### ReportService Interfaces

```typescript
interface ReportDetailsOptions {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

interface ReportDetailsResult {
  report: any;
  issues: any[];
  stats: any;
  sort: { by: string; order: 'asc' | 'desc' };
  pagination: PaginationMeta;
}
```

---

## 🚀 Next Steps

### Có thể cải thiện thêm:

1. **DTOs cho Service Responses:**
   - Tạo DTOs thay vì dùng `any`
   - Type-safe responses

2. **Service Tests:**
   - Viết unit tests cho từng service
   - Test business logic độc lập

3. **Caching Layer:**
   - Thêm caching vào services
   - Giảm database queries

4. **Validation:**
   - Move validation logic vào services
   - Custom validators

---

## ✅ Checklist

- [x] Tạo ProjectService
- [x] Tạo ReportService
- [x] Tạo SettingsService
- [x] Refactor ReportController
- [x] Refactor ProjectController
- [x] Update ReportModule với services mới
- [x] Sử dụng ResponseUtil cho consistent responses
- [x] Error handling với try-catch
- [x] Logging với BaseService

---

## 📚 Files Changed

### New Files:
- `src/services/project.service.ts` (200+ lines)
- `src/services/report.service.ts` (150+ lines)
- `src/services/settings.service.ts` (60+ lines)

### Modified Files:
- `src/report/report.controller.ts` (reduced ~220 lines)
- `src/report/project.controller.ts` (reduced ~24 lines)
- `src/report/report.module.ts` (added new providers)

---

**Created:** 2025-12-01  
**Status:** ✅ Completed


