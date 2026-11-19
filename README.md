# Pricing Bulucu

Bir site adresi verirsiniz. Uygulama o sitenin fiyatlandırma sayfasını bulur ve sayfadaki planları, fiyatları kart olarak gösterir.

Tek bir Cloudflare Worker hem arayüzü hem `POST /api/pricing` ucunu çalıştırır. Metin çıkarımı [Workers AI](https://developers.cloudflare.com/workers-ai/) üzerinden yapılır.

## Panoya tek dosya

Dağıtım dosyası `worker.js` tek bir ES modülüdür; arayüz dosyanın içindedir, ASSETS bağlamı gerekmez.

```bash
npm run bundle
```

Cloudflare panosunda Worker düzenleyicisine bu dosyayı yapıştırın. Uyumluluk tarihi `2026-11-13`, bayrak `nodejs_compat`. Bağlamlar: `AI` (Workers AI) ve `BROWSER` (Browser Run). Değişkenler: `MOCK_AI` = `false`, `AI_MODEL` = `@cf/google/gemma-4-26b-a4b-it`.

Workers Free planda Browser Run günde yaklaşık 10 dakika ile sınırlıdır. Kota dolunca veya tarayıcı açılamazsa Worker düz HTML yedeğine düşer.

## Nasıl çalışır

1. Adres `http` veya `https` olacak şekilde düzeltilir. `localhost`, özel IP aralıkları ve yönlendirme ile bu adreslere kaçış reddedilir.
2. Ana sayfa ve sık görülen yollar denenir: `/pricing`, `/plans`, `/price`, `/fiyatlandirma`, `/fiyatlar`, `/tr/pricing`, `/en/pricing`. Ana sayfadaki `pricing`, `plans`, `fiyat` bağlantıları da taranır.
3. HTML sadeleştirilir: `script`, `style`, menü ve altbilgi atılır, metin model bağlamına sığacak şekilde kısaltılır.
4. Workers AI bu metinden plan listesini JSON olarak çıkarır. Bozuk JSON onarılır. Model boş dönerse veya erişilemezse fiyatlar aynı metinden yedek bir okuyucu ile çıkarılır.
5. Sonuçlar Cache API ile yaklaşık 20 dakika saklanır. Böylece aynı site tekrar sorulduğunda ücretsiz nöron harcanmaz.

Fiyatı sunucu HTML'inde olmayan, tutarı yalnızca tarayıcıda çizen sitelerde uygulama boş bir sonuç ve açıklama döner.

## Modeli

Varsayılan model `@cf/google/gemma-4-26b-a4b-it`.

Bu, Workers AI kataloğunda metin üretimi için duran ve kaldırılma işareti taşımayan bir model. Cloudflare bunu Workers Free planda kullanılabilir modeller arasında sayıyor. Bağlam penceresi 256.000 token. Fiyat yaklaşık 9.091 nöron / milyon girdi token ve 27.273 nöron / milyon çıktı token ([Workers AI fiyatları](https://developers.cloudflare.com/workers-ai/platform/pricing/)). Yapılandırılmış çıkarımda düşünme kapalı (`enable_thinking: false`); böylece nöronlar gerekçe metnine gitmez.

`@cf/meta/llama-3.1-8b-instruct-fp8` 20 Kasım 2026'da kaldırılacağı için kullanılmıyor. Modeli değiştirmek için `wrangler.jsonc` içindeki `AI_MODEL` değerini güncelleyin.

## Yerel çalıştırma

```bash
npm install
npx wrangler dev
```

Workers AI, `wrangler dev` içinde de gerçek hesabınıza bağlanır ve nöron harcar. İlk seferde giriş gerekir:

```bash
npx wrangler login
```

Hesap olmadan arayüzü ve sayfa okuma hattını denemek için mock modu açın. `--local` uzak bağları kapatır, bu yüzden giriş istenmez. Model çağrılmaz; planlar sayfa metninden çıkarılır:

```bash
npx wrangler dev --local --var MOCK_AI:true
```

Geliştirme sunucusu `http://127.0.0.1:43123` adresindedir (`wrangler.jsonc` içindeki `dev.port`). `linear.app`, `notion.so` ve `cal.com` örnek olarak durur.

## Dağıtım

```bash
npx wrangler deploy
```

`MOCK_AI` üretimde `"false"` kalmalıdır. Deploy sonrası Worker, `workers.dev` adresinizde arayüzü ve API'yi birlikte sunar.

## Ücretsiz kota

Workers AI, Workers Free ve Paid planlarda günde **10.000 nöron** verir. Kota her gün **00:00 UTC**'de sıfırlanır. Free planda kotanın üstüne çıkınca istekler durur. Paid planda üstü 1.000 nöron başına $0.011'dir. Güncel tablo: [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).

Önbellek ve kısa sayfa metni bu kotayı korumak içindir. Yine de her yeni site bir model çağrısıdır.

## Sınırlamalar

- Yalnızca HTML'de duran fiyatlar okunur. İstemci tarafında çizilen fiyat tabloları boş sonuç verir.
- DNS yeniden bağlama (rebinding) ile özel ağa çözülen herkese açık bir alan adı, istek anında ayrıca engellenmez. Engellenenler IP olarak yazılmış özel adresler, `localhost` ve bunlara giden yönlendirmelerdir.
- Hız sınırı Worker örneğinin belleğindedir; katı bir küresel limit değildir.
- Model bazen plan adını veya dönemi yanlış ayırabilir. Kartın altındaki kaynak bağlantısı asıl sayfadır.

## Test

```bash
npm test
```

Birim testleri adres güvenliğini, HTML sadeleştirmeyi ve JSON onarımını kontrol eder. Canlı testler `linear.app`, `notion.so` ve `cal.com` üzerinde sayfa bulmayı ve metinden fiyat çıkarmayı dener; ağ gerekir.
