import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

/**
 * Shared layout configurations
 *
 * you can customise layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <>
        <svg
          className="inline-block h-6 w-5"
          fill="currentColor"
          height="92"
          viewBox="0 0 76 92"
          width="76"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>Teak</title>
          <path
            clipRule="evenodd"
            d="M2.19111 65.8874C1.34072 61.8518 7.50774 63.9149 9.24507 64.2683C3.09862 56.1388 -0.383024 47.0649 0.0335827 37.4463C0.113656 35.5554 2.50615 34.7034 3.72971 36.1291C6.61734 39.4933 10.3753 41.8256 14.3598 43.1889C12.3137 23.23 25.9434 11.2328 35.3981 0.683112C36.6364 -0.70293 38.9852 0.157957 39.0653 2.02968C39.3747 8.81684 39.0818 14.5928 43.0997 21.5526C46.8701 16.0616 53.5157 14.241 60.7059 16.1454C62.0362 16.4945 62.6877 18.1005 61.9929 19.3041C57.5254 27.0771 56.5766 37.925 59.1384 49.3391C60.9287 47.0404 62.4467 44.2173 63.4409 41.1592C63.6552 40.5 64.6646 40.173 65.3673 42C67.209 46.7882 68.9796 60.0367 66.8483 64.734C68.7128 63.7567 70.5773 62.4186 72.4502 60.6483C73.0938 60.0401 74.0384 59.8974 74.8263 60.296C75.6142 60.6945 76.0762 61.546 75.9896 62.4353C70.2089 96.9996 12.6549 105.11 2.19111 65.8874Z"
            fillRule="evenodd"
          />
        </svg>
        Teak
      </>
    ),
  },
  // see https://fumadocs.dev/docs/ui/navigation/links
  links: [
    {
      text: 'Docs',
      url: '/docs',
      // secondary items will be displayed differently on navbar
      secondary: false,
    },
  ],
  githubUrl: 'https://github.com/praveenjuge/teak',
};
