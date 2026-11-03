# AppDeploy XHTTP Relay

ريلاي XHTTP مبني على Node.js ويعمل على AppDeploy كخدمة ويب قياسية، مع إبقاء دعم Vercel Serverless اختياريًا. هذه النسخة مقيدة أمنيًا لخادمك `vps.thumbayan.com` فقط وليست open proxy.

## النشر على AppDeploy

1. اربط المستودع بـ AppDeploy أو اطلب من وكيلك المتصل بـ AppDeploy نشره.
2. اضبط المتغيرين التاليين في إعدادات البيئة:

```env
TARGET_DOMAIN=https://vps.thumbayan.com:443
RELAY_TOKEN=ضع_رمزًا_عشوائيًا_طويلًا_هنا
```

`TARGET_DOMAIN` يخضع لـ allowlist صارم؛ أي نطاق أو عنوان IP آخر يرفضه التطبيق. `RELAY_TOKEN` مطلوب لتفادي نشر relay عام، ويرسل العميل الرمز في الهيدر `X-Relay-Token`.

3. اترك أمر التشغيل `npm start`. سيستخدم التطبيق المنفذ الذي توفره AppDeploy عبر `PORT` ويستمع على `0.0.0.0`.
4. استخدم `/healthz` أو `/readyz` لفحص الصحة. هذان المساران لا يحتاجان رمز المصادقة.

يحتوي `package.json` على أوامر `build` و`test` ولا يعتمد التشغيل الإنتاجي على Vercel CLI أو خدمة خارجية.

## متغيرات البيئة

| المتغير | مطلوب | الوصف |
|---|---:|---|
| `TARGET_DOMAIN` | لا | يجب أن يكون `https://vps.thumbayan.com:443`؛ القيمة الافتراضية مقيدة بهذا العنوان. |
| `RELAY_TOKEN` | نعم للتوجيه | رمز سري طويل يرسل عبر `X-Relay-Token`. |
| `PORT` | لا | يضبطه AppDeploy تلقائيًا؛ القيمة المحلية الافتراضية `3000`. |
| `UPSTREAM_TIMEOUT_MS` | لا | مهلة الخادم الهدف بالمللي ثانية، والافتراضي `55000`. |

لا تستخدم `ALLOW_UNAUTHENTICATED_RELAY=true` في الإنتاج. هذا الخيار موجود فقط للاختبارات المحلية المعزولة.

## التشغيل المحلي

```bash
cp .env.example .env
# عدّل RELAY_TOKEN إلى قيمة عشوائية طويلة
set -a; . ./.env; set +a
npm start
```

فحص الصحة:

```bash
curl http://localhost:3000/healthz
```

طلب relay:

```bash
curl -H "X-Relay-Token: $RELAY_TOKEN" http://localhost:3000/your-path
```

## الاختبار والبناء

```bash
npm test
npm run build
```

الاختبارات تستخدم `node:test` المدمج، لذلك لا توجد تبعيات إنتاجية إضافية.

## ضوابط الأمان

- لا يقبل التطبيق إلا `https://vps.thumbayan.com`، ويرفض عناوين IP والنطاقات الأخرى.
- لا يقبل absolute-form URLs التي يمكن استخدامها لتجاوز عنوان الخادم الهدف.
- يتطلب رمز مصادقة قبل تمرير أي طلب، ويقارنه باستخدام مقارنة ثابتة الزمن.
- يزيل هيدرات hop-by-hop وهيدر رمز المصادقة قبل الإرسال إلى الخادم الهدف.
- يضع حدًا أقصى لحجم جسم الطلب قدره 100 MiB.
- يمرر عنوان العميل الذي يراه الخادم فقط في `X-Forwarded-For` بدل الوثوق بقيمة يرسلها العميل.

## دعم Vercel الاختياري

يبقى `api/index.js` و`vercel.json` متاحين للنشر على Vercel. اضبط `TARGET_DOMAIN` و`RELAY_TOKEN` في إعدادات المشروع. أما AppDeploy فيستخدم نقطة التشغيل القياسية `index.js` و`npm start`.
