# arp_sys — نظام إدارة الحركة العقارية

نظام داخلي لإدارة الحركة العقارية (مباني، وحدات، عملاء، حجوزات، عقود، تحصيلات وتقارير)، بواجهة عربية RTL.

- `backend/` — Laravel 12، واجهة برمجية فقط تحت `/api/v1`، مصادقة Sanctum، سجل تدقيق.
- `front/` — React 19 + Vite + Tailwind CSS v4 (نموذج Figma Make)؛ صفحات الحركة والتقارير الموصولة تعمل على الـAPI.
- `AGENTS.md` (في الجذر) — دليل سريع للمشروع. تفاصيل الخادم في `backend/AGENTS.md` و`backend/docs/BRIEF.md`،
  والواجهة في `front/AGENTS.md`.

## المتطلبات

- PHP 8.2+ وComposer، MariaDB/MySQL 10.4+ (الهدف MySQL 8)
- Node.js 20+ وnpm

## تشغيل الخادم

```bash
cd backend
cp .env.example .env
composer install
php artisan key:generate
php artisan migrate --seed        # ينشئ أول مدير: admin / password123
./scripts/serve.sh                # http://127.0.0.1:8000
```

## تشغيل الواجهة

```bash
cd front
npm install
npm run dev                       # http://localhost:8443 (يوجّه /api إلى 127.0.0.1:8000)
```

## الاختبارات والجودة

```bash
cd backend
php artisan test                  # 183 اختبار Pest
vendor/bin/pint                   # تنسيق الكود
```

```bash
cd front
npx tsc --noEmit
npm run build
```

## ملاحظات

- كل المبالغ `DECIMAL(14,2)` وتُحسب عبر `MoneyCalculator`؛ البيانات المالية لا تُحذف، بل تُلغى بسبب.
- لا تُرفع ملفات `.env` أو الأسرار؛ انظر `.gitignore` في كل مجلد.
- لا يُنشأ أي commit أو نشر دون طلب صريح.
