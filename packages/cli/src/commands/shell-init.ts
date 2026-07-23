export async function shellInitCommand(): Promise<void> {
  console.log(`# >>> OreoDeck shell integration v2 >>>
# Add ONCE to ~/.zshrc:
#   oreodeck shell-init >> ~/.zshrc
# Use \`ord use --tab <profile>\` to pin only the current terminal tab.
export OREODECK_SHELL_INTEGRATION=1
ord() {
  if [ "\${1-}" = "use" ] && { [ "\${2-}" = "--tab" ] || [ "\${2-}" = "-t" ]; }; then
    command ord use "\${3-}" --tab || return
    export OREODECK_PROFILE="\${3-}"
  else
    command ord "$@"
  fi
}
oreodeck() {
  if [ "\${1-}" = "use" ] && { [ "\${2-}" = "--tab" ] || [ "\${2-}" = "-t" ]; }; then
    command oreodeck use "\${3-}" --tab || return
    export OREODECK_PROFILE="\${3-}"
  else
    command oreodeck "$@"
  fi
}
claude() { command ord run "$@"; }
# <<< OreoDeck shell integration v2 <<<`);
}
