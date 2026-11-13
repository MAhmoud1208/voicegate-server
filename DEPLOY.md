# Voice Gate — سيرفر الترخيص (رفع ثابت على السحابة)

بعد الرفع ده: السيرفر على السحابة، والكيهات في مخزن ثابت (Upstash). **جهازك ممكن يبقى مقفول خالص** والعملاء يفعّلوا عادي، وتعمل كيهات من أي متصفح أو موبايل.

## المفتاح العام (موجود جوه البلاجن في js/config.js)
```
MCowBQYDK2VwAyEAIekqqjG/3FRJFwcLSTdCkGZBO7lxJgnGBvNEKCRLRsM=
```
**المفتاح السري** في `data/private.pem` — ده أهم حاجة، متحطّهوش على جيت هب ومتبعتهوش لحد. اعمله باك أب.

---

## 1) مخزن ثابت مجاني — Upstash Redis
1. اعمل حساب على https://upstash.com (مجاني، من غير كارت).
2. Create Database > Redis > اختار أقرب ريجن > Free.
3. من صفحة الداتابيز، في قسم **REST API**، انسخ:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

## 2) رفع السيرفر — Render
1. اعمل حساب على https://render.com (مجاني).
2. ارفع فولدر `server` على ريبو **خاص (private)** على GitHub.
   - اتأكد إن `data/private.pem` **مش** مترفوع (`.gitignore` بيمنعه).
3. Render > New > Web Service > اختار الريبو > Plan: **Free**.
   - Build Command: `npm install`
   - Start Command: `node server.js`
4. في **Environment**، ضيف المتغيّرات دي:

   | المتغيّر | القيمة |
   |---|---|
   | `VG_PRIVATE_KEY` | المفتاح السري base64 (الأمر تحت يطبعه) |
   | `UPSTASH_REDIS_REST_URL` | من Upstash |
   | `UPSTASH_REDIS_REST_TOKEN` | من Upstash |
   | `VG_ADMIN_TOKEN` | كلمة سر تخترعها إنت (لإنشاء الكيهات) |
   | `VG_CHECK_DAYS` | `14` |

   طباعة المفتاح السري base64 (من فولدر server على جهازك):
   ```
   node -e "const fs=require('fs'),c=require('crypto');console.log(Buffer.from(c.createPrivateKey(fs.readFileSync('./data/private.pem')).export({format:'der',type:'pkcs8'})).toString('base64'))"
   ```
5. Deploy. هيديك رابط زي `https://voicegate.onrender.com`.
6. افتح الرابط في المتصفح — لازم يرد وفيه **`"store":"upstash"`**. كده المخزن الثابت شغّال.

---

## 3) إنشاء الكيهات (من غير جهازك)
افتح ملف **`admin.html`** في أي متصفح (على موبايلك كمان):
- حط رابط السيرفر + `VG_ADMIN_TOKEN`.
- اختار النوع (مدى الحياة / باشتراك) والعدد > «اعمل كيهات».
- فيه كمان: عرض كل الكيهات، سحب كي، فكّه من جهاز.

> ملاحظة: الكيهات اللي اتعملت وانت بتجرّب محلي متخزّنة في `data/keys.json` بس، مش في Upstash. بعد الرفع اعمل كيهات جديدة من `admin.html` وهي اللي العملاء هيستخدموها.

---

## 4) ظبط البلاجن وتوزيعها
1. في `plugin/js/config.js` حط رابط Render:
   ```js
   module.exports = {
     SERVER_URL: 'https://voicegate.onrender.com',
     PUBLIC_KEY: 'MCowBQYDK2VwAyEAIekqqjG/3FRJFwcLSTdCkGZBO7lxJgnGBvNEKCRLRsM='
   };
   ```
2. لِمّ البلاجن في ZIP:
   ```
   Compress-Archive -Path "E:\claud projects\VoiceGate\plugin\*" -DestinationPath "$env:USERPROFILE\Desktop\VoiceGate.zip" -Force
   ```
3. العميل: يفك الضغط > Install.bat > يقفل بريميير ويفتحه > يفعّل بالكي اللي بعتهوله.

> نفس الـ `config.js` ده حطّه في نسختك المتسطّبة كمان (`%APPDATA%\Adobe\CEP\extensions\VoiceGate\js\config.js`) عشان جهازك يستخدم السحابة بدل localhost.

---

## ملاحظات
- Render الفري بينام بعد خمول وبيصحى في أول طلب (عشان كده مهلة البلاجن 30 ثانية). التفعيل والمراجعة بيشتغلوا عادي بعد الصحيان.
- لو عميل غيّر جهازه: من `admin.html` دوس «فكّه من الجهاز».
- الاشتراك بالأيام بيبدأ من أول تفعيل، ومحفوظ وموقّع، فبيتحسب صح حتى أوفلاين.

## endpoints (للمرجع)
- `POST /api/validate` — البلاجن بتفعّل بيه.
- `POST /api/update` — بيرد `update:false` (التحديث التلقائي مش مفعّل لسه).
- `POST /api/admin/newkey` · `GET /api/admin/list` · `POST /api/admin/revoke` · `POST /api/admin/unbind` — بالهيدر `x-admin-token`.
