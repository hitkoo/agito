import gitoTokenImage from '../assets/gito.png'

interface GitoTokenIconProps {
  size?: number
  className?: string
}

export function GitoTokenIcon(props: GitoTokenIconProps): JSX.Element {
  const { size = 20, className } = props

  return (
    <img
      src={gitoTokenImage}
      alt="Gito token"
      width={size}
      height={size}
      className={className}
      style={{ imageRendering: 'pixelated' }}
    />
  )
}
