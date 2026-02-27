// Number and token formatting utilities

export function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return Math.round(num).toString();
}

export function formatTokenAmount(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(2) + 'K';
  } else if (num >= 1) {
    return num.toFixed(2);
  } else if (num > 0) {
    return num.toFixed(4);
  }
  return '0';
}
