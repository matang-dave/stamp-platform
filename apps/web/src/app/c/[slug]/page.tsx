import { notFound } from 'next/navigation';
import { EnrollForm } from './enroll-form';
import { fetchCafePublicInfo } from './enrollment-api';

interface Props {
  params: Promise<{ slug: string }>;
}

// Customer enrollment page — target of the printed counter QR.
// Café info is fetched server-side; unknown/disabled cafés 404.
export default async function EnrollmentPage({ params }: Props) {
  const { slug } = await params;
  const cafe = await fetchCafePublicInfo(slug);
  if (!cafe) notFound();

  return (
    <main className="mx-auto max-w-md p-6">
      <header
        className="rounded-2xl p-6 text-white"
        style={{ backgroundColor: cafe.brandColor }}
      >
        <h1 className="text-2xl font-semibold">{cafe.name}</h1>
        <p className="mt-1 text-sm opacity-90">
          Collect {cafe.stampsRequired} stamps, get a free coffee. / Sammle{' '}
          {cafe.stampsRequired} Stempel, erhalte einen Gratiskaffee.
        </p>
      </header>

      <EnrollForm slug={slug} brandColor={cafe.brandColor} />

      <section
        aria-labelledby="privacy-heading"
        className="mt-8 border-t pt-4 text-xs text-neutral-500"
      >
        <h2 id="privacy-heading" className="font-semibold text-neutral-600">
          Datenschutz / Privacy
        </h2>
        {/* TODO(human): replace placeholder privacy copy with reviewed legal text (DE + EN). */}
        <p className="mt-2">
          Für die Stempelkarte selbst ist keine E-Mail-Adresse nötig. Wenn du
          eine angibst, verwenden wir sie nur mit deiner ausdrücklichen
          Einwilligung für Neuigkeiten dieses Cafés. Du kannst die Einwilligung
          jederzeit widerrufen. (Platzhaltertext — finale Fassung folgt.)
        </p>
        <p className="mt-2">
          No email address is required for the stamp card itself. If you provide
          one, we only use it with your explicit consent for updates from this
          café. You can withdraw consent at any time. (Placeholder text — final
          copy to follow.)
        </p>
      </section>
    </main>
  );
}
