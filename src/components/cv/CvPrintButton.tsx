'use client'

/**
 * Opens the browser print dialog, where "Save as PDF" produces the file.
 *
 * This replaces a checked-in PDF that had to be re-exported by hand after every edit and
 * silently drifted when nobody did. Printing the live page cannot drift: the sheets you
 * see are the sheets that print, and the `@page`/`@media print` rules in the CV stylesheet
 * already reproduce them at true A4 with the on-screen scaling turned off.
 */
export default function CvPrintButton() {
  return (
    <button type='button' className='dl' onClick={() => window.print()}>
      <svg
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='2.2'
        strokeLinecap='round'
        strokeLinejoin='round'
        aria-hidden='true'
      >
        <path d='M12 3v12' />
        <path d='m7 10 5 5 5-5' />
        <path d='M4 20h16' />
      </svg>
      Save as PDF
    </button>
  )
}
