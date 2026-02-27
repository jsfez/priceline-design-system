function getPopoverStyles({ arrowX, arrowY, isPositioned, placement = 'top', strategy = 'absolute', x, y }) {
  const side = placement.split('-')[0]
  const oppositeSide = {
    top: 'bottom',
    right: 'left',
    bottom: 'top',
    left: 'right',
  }[side]

  const styles = {
    arrow: {
      top: arrowY ?? '',
      left: arrowX ?? '',
      right: '',
      bottom: '',
      [oppositeSide]: '3px',
    },
    popover: {
      position: strategy,
      top: y ?? 0,
      left: x ?? 0,
      visibility: isPositioned ? 'visible' : 'hidden',
    },
  }
  return styles
}

export default getPopoverStyles
