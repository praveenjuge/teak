interface FAQItemProps {
  question: string;
  answer: string;
}

export function FAQItem({ question, answer }: FAQItemProps) {
  return (
    <details className="rounded-lg border border-fd-border bg-fd-card p-6">
      <summary className="cursor-pointer font-semibold text-lg">
        {question}
      </summary>
      <p className="mt-4 text-fd-muted-foreground">{answer}</p>
    </details>
  );
}
