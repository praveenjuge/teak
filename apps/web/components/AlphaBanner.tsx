export default function AlphaBanner() {
  return (
    <div
      className="flex min-h-7 items-center justify-center px-4 text-center text-xs font-semibold uppercase text-primary
       bg-[repeating-linear-gradient(-45deg,var(--color-red-50)_0px,var(--color-red-50)_10px,transparent_10px,transparent_20px)]
       dark:bg-[repeating-linear-gradient(-45deg,var(--color-gray-900)_0px,var(--color-gray-900)_10px,transparent_10px,transparent_20px)] -z-10 relative
      "
    >
      <span>Super Early Build • Things Might Break</span>
    </div>
  );
}
