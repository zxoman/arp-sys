/** Fixed ambient background: exactly two drifting blobs behind all content. */
export function MeshBackground() {
  return (
    <div className="mesh" aria-hidden="true">
      <span className="mesh-blob mesh-blob-1" />
      <span className="mesh-blob mesh-blob-2" />
    </div>
  )
}
