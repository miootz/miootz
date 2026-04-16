import { formatDistanceToNow, format } from 'date-fns';

export const formatRelativeTime = (dateString: string) => {
  const date = new Date(dateString);
  return formatDistanceToNow(date, { addSuffix: true });
};

export const formatAbsoluteTime = (dateString: string) => {
  const date = new Date(dateString);
  return format(date, 'dd/MM/yy HH:mm:ss');
};
