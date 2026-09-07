interface Props {
  params: Promise<{ slug: string }>;
}

// Customer enrollment page — target of the printed counter QR (milestone 3).
// Zero required fields; optional email + unbundled marketing consent checkbox.
export default async function EnrollmentPage({ params }: Props) {
  const { slug } = await params;
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">Join the stamp card</h1>
      <p className="mt-2 text-neutral-500">
        Enrollment page for café “{slug}” — wallet buttons land here in milestone 3.
      </p>
    </main>
  );
}
