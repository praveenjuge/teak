interface FAQItemProps {
  answer: string;
  question: string;
}

export function FAQItem({ question, answer }: FAQItemProps) {
  return (
    <details className="rounded-lg border border-border bg-card p-6">
      <summary className="cursor-pointer font-semibold text-lg">
        {question}
      </summary>
      <p className="mt-4 text-muted-foreground">{answer}</p>
    </details>
  );
}
