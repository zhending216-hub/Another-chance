import StoryDetailClient from './StoryDetailClient';

interface StoryPageProps {
  params: {
    id: string;
  };
}

export default function StoryDetailPage({ params }: StoryPageProps) {
  return <StoryDetailClient storyId={params.id} />;
}
