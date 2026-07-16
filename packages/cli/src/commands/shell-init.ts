export async function shellInitCommand(): Promise<void> {
  console.log(`# ccm shell integration — add to ~/.zshrc:
#   ccm shell-init >> ~/.zshrc
# Then \`claude\` always runs through your active ccm profile.
claude() { command ccm claude "$@"; }`);
}
