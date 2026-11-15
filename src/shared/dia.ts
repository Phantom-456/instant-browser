export const DIA_ID = 'company.thebrowser.dia'

/** Dia keeps its profiles ("spaces of tabs") in its AppleScript interface. Names only; this script reads nothing else. */
export const DIA_LIST_SCRIPT = `tell application "Dia"
	set AppleScript's text item delimiters to linefeed
	return (name of profiles of window 1) as text
end tell`

/**
 * Open a link as a new tab in one Dia profile and bring it forward.
 * The profile name and the URL come in as arguments (argv), never inside the script text.
 */
export const DIA_OPEN_SCRIPT = `on run argv
	set profileName to item 1 of argv
	set theURL to item 2 of argv
	tell application "Dia"
		set p to first profile of window 1 whose name is profileName
		make new tab at end of tabs of p with properties {URL:theURL}
		focus (last tab of p)
		activate
	end tell
end run`

/** One name per line, without empty lines or repeats. */
export function parseProfileNames(output: string): string[] {
  return [...new Set(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))]
}
