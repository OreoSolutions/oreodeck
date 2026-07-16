export async function shellInitCommand(): Promise<void> {
  console.log(`# ccm shell integration — add ONCE to ~/.zshrc:
#   ccm shell-init >> ~/.zshrc
# Then \`claude\` always runs through your active ccm profile.
# (Running the line above more than once just redefines the function again —
# harmless, but sloppy; no need to append it twice.)
claude() { command ccm claude "$@"; }`);
}
