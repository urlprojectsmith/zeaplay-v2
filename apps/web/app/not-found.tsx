import { ErrorState } from '../components/states/ErrorState';

export default function NotFound() {
  return (
    <ErrorState title="Page not found" description="The page you requested is not available." />
  );
}
