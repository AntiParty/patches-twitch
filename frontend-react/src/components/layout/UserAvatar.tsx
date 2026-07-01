/* Circular user avatar — image if provided, otherwise the first initial.
 * Plus a UserProfile composite (avatar + name + role) for the sidebar footer. */
import styles from './UserAvatar.module.css'

interface UserAvatarProps {
  name: string
  imageUrl?: string | null
  size?: number
}

export function UserAvatar({ name, imageUrl, size = 36 }: UserAvatarProps) {
  const initial = name?.charAt(0).toUpperCase() || 'U'
  return (
    <div className={styles.avatar} style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {imageUrl ? <img src={imageUrl} alt={name} /> : initial}
    </div>
  )
}

export function UserProfile({
  name,
  role,
  imageUrl,
}: {
  name: string
  role?: string
  imageUrl?: string | null
}) {
  return (
    <div className={styles.profile}>
      <UserAvatar name={name} imageUrl={imageUrl} />
      <div className={styles.meta}>
        <div className={styles.name}>{name}</div>
        {role && <div className={styles.role}>{role}</div>}
      </div>
    </div>
  )
}
