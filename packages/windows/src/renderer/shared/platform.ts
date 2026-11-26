/** Mark the page with the system it runs on (html.mac or html.win), so the styles can follow each system's conventions. */
export const platform: 'mac' | 'win' | 'other' = /Mac/i.test(navigator.platform) ? 'mac' : /Win/i.test(navigator.platform) ? 'win' : 'other'
document.documentElement.classList.add(platform)
