import { serializeJsonLd, type JsonLdObject } from '@/lib/seo/jsonld';

/** One <script type="application/ld+json"> per entity, server-rendered. */
export default function JsonLd({ data }: { data: JsonLdObject | JsonLdObject[] }) {
  const items = Array.isArray(data) ? data : [data];
  return (
    <>
      {items.map((item, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(item) }}
        />
      ))}
    </>
  );
}
