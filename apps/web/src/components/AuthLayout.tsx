import type { ReactNode } from "react";
import Logo from "./Logo";

interface AuthLayoutProps {
  children: ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <>
      <main className="mx-auto flex max-w-xs flex-col items-center justify-center space-y-8 py-14 md:h-screen">
        <Logo />
        <section className="w-full space-y-5">{children}</section>
      </main>
      {/* top pattern */}
      <svg
        className="pointer-events-none absolute left-0 top-0 z-[-1] hidden select-none md:block"
        width="542"
        height="335"
        viewBox="0 0 542 335"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g clipPath="url(#clip0_4755_1448)">
          <path
            d="M333.407 -223.331L299.243 -95.8287L426.745 -61.6646L460.909 -189.167L333.407 -223.331Z"
            className="fill-orange-300 dark:fill-neutral-700"
          />
          <path
            d="M171.46 -129.831L137.296 -2.3287L263.894 31.5932L298.963 -95.6668L171.46 -129.831Z"
            className="fill-orange-300 dark:fill-neutral-700"
          />
          <path
            d="M9.51373 -36.3309L-24.6504 91.1713L101.948 125.093L137.016 -2.16681L9.51373 -36.3309Z"
            className="fill-orange-300 dark:fill-neutral-700"
          />
          <path
            d="M-152.433 57.1691L-186.597 184.671L-59.0949 218.835L-24.9308 91.3332L-152.433 57.1691Z"
            className="fill-orange-300 dark:fill-neutral-700"
          />
          <path
            d="M-314.38 150.669L-348.544 278.171L-221.042 312.335L-186.878 184.833L-314.38 150.669Z"
            className="fill-orange-300 dark:fill-neutral-700"
          />
          <path
            d="M-476.327 244.169L-510.491 371.671L-382.988 405.835L-348.824 278.333L-476.327 244.169Z"
            className="fill-orange-300 dark:fill-neutral-700"
          />
          <path
            d="M-638.273 337.669L-672.437 465.171L-544.935 499.335L-510.771 371.833L-638.273 337.669Z"
            className="fill-orange-300 dark:fill-neutral-700"
          />
          <path
            d="M-800.22 431.169L-834.384 558.671L-706.882 592.835L-672.718 465.333L-800.22 431.169Z"
            className="fill-orange-300 dark:fill-neutral-700"
          />
          <path
            d="M460.286 -189.571L426.122 -62.0687L553.624 -27.9046L587.788 -155.407L460.286 -189.571Z"
            className="fill-orange-200 dark:fill-neutral-800"
          />
          <path
            d="M298.339 -96.0709L263.894 31.5932L392.285 63.3253L425.841 -61.9068L298.339 -96.0709Z"
            className="fill-orange-200 dark:fill-neutral-800"
          />
          <path
            d="M136.392 -2.57094L101.948 125.093L229.73 159.095L263.894 31.5932L136.392 -2.57094Z"
            className="fill-orange-200 dark:fill-neutral-800"
          />
          <path
            d="M-25.5545 90.929L-59.7186 218.431L68.3919 250.325L101.948 125.093L-25.5545 90.929Z"
            className="fill-orange-200 dark:fill-neutral-800"
          />
          <path
            d="M-187.501 184.429L-221.665 311.931L-94.1631 346.095L-59.999 218.593L-187.501 184.429Z"
            className="fill-orange-200 dark:fill-neutral-800"
          />
          <path
            d="M-349.448 277.929L-383.612 405.431L-256.11 439.595L-221.946 312.093L-349.448 277.929Z"
            className="fill-orange-200 dark:fill-neutral-800"
          />
          <path
            d="M-511.395 371.429L-545.559 498.931L-418.057 533.095L-383.893 405.593L-511.395 371.429Z"
            className="fill-orange-200 dark:fill-neutral-800"
          />
          <path
            d="M-673.342 464.929L-707.506 592.431L-580.003 626.595L-545.839 499.093L-673.342 464.929Z"
            className="fill-orange-200 dark:fill-neutral-800"
          />
          <path
            d="M-835.288 558.429L-869.452 685.931L-741.95 720.095L-707.786 592.593L-835.288 558.429Z"
            className="fill-orange-200 dark:fill-neutral-800"
          />
          <path
            d="M426.45 -64.177L392.285 63.3253C462.703 82.1936 535.083 40.4047 553.952 -30.0128L426.45 -64.177Z"
            className="fill-orange-100 dark:fill-neutral-900"
          />
          <path
            d="M263.894 31.5932L229.73 159.095C300.148 177.964 373.417 133.743 392.285 63.3253L263.894 31.5932Z"
            className="fill-orange-100 dark:fill-neutral-900"
          />
          <path
            d="M101.948 125.093L68.3919 250.325C138.809 269.194 210.862 229.513 229.73 159.095L101.948 125.093Z"
            className="fill-orange-100 dark:fill-neutral-900"
          />
          <path
            d="M-59.3907 216.323L-93.5548 343.825C-23.1373 362.694 49.5236 320.743 68.3919 250.325L-59.3907 216.323Z"
            className="fill-orange-100 dark:fill-neutral-900"
          />
          <path
            d="M-221.337 309.823L-255.502 437.325C-185.084 456.194 -112.704 414.405 -93.8353 343.987L-221.337 309.823Z"
            className="fill-orange-100 dark:fill-neutral-900"
          />
          <path
            d="M-383.284 403.323L-417.448 530.825C-347.031 549.694 -274.65 507.905 -255.782 437.487L-383.284 403.323Z"
            className="fill-orange-100 dark:fill-neutral-900"
          />
          <path
            d="M-545.231 496.823L-579.395 624.325C-508.978 643.194 -436.597 601.405 -417.729 530.987L-545.231 496.823Z"
            className="fill-orange-100 dark:fill-neutral-900"
          />
          <path
            d="M-707.178 590.323L-741.342 717.825C-670.924 736.694 -598.544 694.905 -579.676 624.487L-707.178 590.323Z"
            className="fill-orange-100 dark:fill-neutral-900"
          />
        </g>
        <defs>
          <clipPath id="clip0_4755_1448">
            <rect width="542" height="335" fill="white" />
          </clipPath>
        </defs>
      </svg>
      {/* bottom pattern */}
      <svg
        className="pointer-events-none absolute bottom-0 right-0 z-[-1] select-none"
        width="674"
        height="272"
        viewBox="0 0 674 272"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g clipPath="url(#clip0_4755_1451)">
          <path
            d="M161.619 547.932L210.701 425.396L88.166 376.314L39.0836 498.849L161.619 547.932Z"
            className="fill-orange-300 dark:fill-neutral-700"
          />
          <path
            d="M333.534 474.351L382.617 351.816L260.081 302.734L210.999 425.269L333.534 474.351Z"
            className="fill-orange-300 dark:fill-neutral-700"
          />
          <path
            d="M505.45 400.771L554.83 278.236L431.992 231.683L382.915 351.689L505.45 400.771Z"
            className="fill-orange-300 dark:fill-neutral-700"
          />
          <path
            d="M677.365 327.191L726.448 204.655L603.907 158.102L554.83 278.236L677.365 327.191Z"
            className="fill-orange-300 dark:fill-neutral-700"
          />
          <path
            d="M849.281 253.61L898.363 131.075L775.828 81.9923L726.745 204.528L849.281 253.61Z"
            className="fill-orange-300 dark:fill-neutral-700"
          />
          <path
            d="M1021.2 180.03L1070.28 57.4943L947.743 8.4119L898.661 130.947L1021.2 180.03Z"
            className="fill-orange-300 dark:fill-neutral-700"
          />
          <path
            d="M1193.11 106.449L1242.19 -16.0861L1119.66 -65.1685L1070.58 57.3669L1193.11 106.449Z"
            className="fill-orange-300 dark:fill-neutral-700"
          />
          <path
            d="M1365.03 32.8689L1414.11 -89.6665L1291.57 -138.749L1242.49 -16.2135L1365.03 32.8689Z"
            className="fill-orange-300 dark:fill-neutral-700"
          />
          <path
            d="M39.6548 499.325L88.7372 376.789L-33.7982 327.707L-82.8806 450.242L39.6548 499.325Z"
            className="fill-orange-200 dark:fill-neutral-800"
          />
          <path
            d="M210.994 427.799L260.076 305.263L137.541 256.181L88.4587 378.716L210.994 427.799Z"
            className="fill-orange-200 dark:fill-neutral-800"
          />
          <path
            d="M383.486 352.164L431.992 231.683L309.457 182.6L260.95 303.082L383.486 352.164Z"
            className="fill-orange-200 dark:fill-neutral-800"
          />
          <path
            d="M554.83 278.236L603.907 158.102L481.372 109.02L431.992 231.683L554.83 278.236Z"
            className="fill-orange-200 dark:fill-neutral-800"
          />
          <path
            d="M726.443 207.185L775.525 84.6494L652.413 37.6213L603.907 158.102L726.443 207.185Z"
            className="fill-orange-200 dark:fill-neutral-800"
          />
          <path
            d="M899.232 131.423L948.315 8.88733L825.779 -40.1951L776.697 82.3403L899.232 131.423Z"
            className="fill-orange-200 dark:fill-neutral-800"
          />
          <path
            d="M1071.15 57.8423L1120.23 -64.6931L997.695 -113.775L948.612 8.75989L1071.15 57.8423Z"
            className="fill-orange-200 dark:fill-neutral-800"
          />
          <path
            d="M1243.06 -15.7381L1292.15 -138.273L1169.61 -187.356L1120.53 -64.8205L1243.06 -15.7381Z"
            className="fill-orange-200 dark:fill-neutral-800"
          />
          <path
            d="M1414.98 -89.3185L1464.06 -211.854L1341.53 -260.936L1292.44 -138.401L1414.98 -89.3185Z"
            className="fill-orange-200 dark:fill-neutral-800"
          />
          <path
            d="M88.1609 378.844L137.541 256.181C69.8666 229.073 -7.26698 262.087 -34.3744 329.761L88.1609 378.844Z"
            className="fill-orange-100 dark:fill-neutral-900"
          />
          <path
            d="M260.076 305.263L309.457 182.6C241.782 155.493 164.649 188.506 137.541 256.181L260.076 305.263Z"
            className="fill-orange-100 dark:fill-neutral-900"
          />
          <path
            d="M431.992 231.683L481.372 109.02C413.698 81.9126 336.564 114.926 309.457 182.6L431.992 231.683Z"
            className="fill-orange-100 dark:fill-neutral-900"
          />
          <path
            d="M603.907 158.102L652.413 37.6213C584.739 10.5138 508.479 41.3456 481.372 109.02L603.907 158.102Z"
            className="fill-orange-100 dark:fill-neutral-900"
          />
          <path
            d="M775.823 84.522L824.905 -38.0134C757.231 -65.1208 679.521 -30.0531 652.413 37.6213L775.823 84.522Z"
            className="fill-orange-100 dark:fill-neutral-900"
          />
          <path
            d="M947.738 10.9416L996.821 -111.594C929.146 -138.701 852.31 -105.815 825.203 -38.1408L947.738 10.9416Z"
            className="fill-orange-100 dark:fill-neutral-900"
          />
          <path
            d="M1119.65 -62.6388L1168.74 -185.174C1101.06 -212.282 1024.23 -179.396 997.118 -111.721L1119.65 -62.6388Z"
            className="fill-orange-100 dark:fill-neutral-900"
          />
          <path
            d="M1291.57 -136.219L1340.65 -258.755C1272.98 -285.862 1196.14 -252.976 1169.03 -185.302L1291.57 -136.219Z"
            className="fill-orange-100 dark:fill-neutral-900"
          />
        </g>
        <defs>
          <clipPath id="clip0_4755_1451">
            <rect width="674" height="272" fill="white" />
          </clipPath>
        </defs>
      </svg>
    </>
  );
}
