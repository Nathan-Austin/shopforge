"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, Youtube, Pencil, X, Check } from "lucide-react";

export default function ReviewsClient({ reviews: initialReviews }: { reviews: any[] }) {
  const [reviews, setReviews] = useState(initialReviews);
  const [loading, setLoading] = useState(false);
  const [newReview, setNewReview] = useState({ title: "", reviewer: "", youtube_id: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: "", reviewer: "", youtube_id: "" });
  const router = useRouter();

  async function handleAdd() {
    if (!newReview.title || !newReview.youtube_id) return;
    setLoading(true);
    
    const { data, error } = await supabase
      .from("video_reviews")
      .insert([newReview])
      .select()
      .single();

    if (!error && data) {
      setReviews([...reviews, data]);
      setNewReview({ title: "", reviewer: "", youtube_id: "" });
      router.refresh();
    }
    setLoading(false);
  }

  async function handleUpdate() {
    if (!editingId || !editForm.title || !editForm.youtube_id) return;
    setLoading(true);

    const { error } = await supabase
      .from("video_reviews")
      .update(editForm)
      .eq("id", editingId);

    if (!error) {
      setReviews(reviews.map(r => r.id === editingId ? { ...r, ...editForm } : r));
      setEditingId(null);
      router.refresh();
    }
    setLoading(false);
  }

  function startEditing(review: any) {
    setEditingId(review.id);
    setEditForm({
      title: review.title || "",
      reviewer: review.reviewer || "",
      youtube_id: review.youtube_id || ""
    });
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure?")) return;
    setLoading(true);
    const { error } = await supabase.from("video_reviews").delete().eq("id", id);
    if (!error) {
      setReviews(reviews.filter(r => r.id !== id));
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Video Title</Label>
              <Input 
                value={newReview.title} 
                onChange={e => setNewReview({...newReview, title: e.target.value})}
                placeholder="e.g. Taste test video"
              />
            </div>
            <div className="space-y-2">
              <Label>Reviewer Name</Label>
              <Input 
                value={newReview.reviewer} 
                onChange={e => setNewReview({...newReview, reviewer: e.target.value})}
                placeholder="e.g. Reviewer name"
              />
            </div>
            <div className="space-y-2">
              <Label>YouTube ID</Label>
              <div className="flex gap-2">
                <Input 
                  value={newReview.youtube_id} 
                  onChange={e => setNewReview({...newReview, youtube_id: e.target.value})}
                  placeholder="e.g. dQw4w9WgXcQ"
                />
                <Button onClick={handleAdd} disabled={loading || !newReview.title || !newReview.youtube_id}>
                  <Plus className="h-4 w-4 mr-2" /> Add
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reviews.map((review) => (
          <Card key={review.id}>
            <CardContent className="pt-6">
              {editingId === review.id ? (
                <div className="space-y-3">
                  <Input
                    value={editForm.title}
                    onChange={e => setEditForm({...editForm, title: e.target.value})}
                    placeholder="Title"
                  />
                  <Input
                    value={editForm.reviewer}
                    onChange={e => setEditForm({...editForm, reviewer: e.target.value})}
                    placeholder="Reviewer"
                  />
                  <Input
                    value={editForm.youtube_id}
                    onChange={e => setEditForm({...editForm, youtube_id: e.target.value})}
                    placeholder="YouTube ID"
                  />
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" className="flex-1" onClick={handleUpdate} disabled={loading}>
                      <Check className="h-4 w-4 mr-1" /> Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)} disabled={loading}>
                      <X className="h-4 w-4 mr-1" /> Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="bg-red-100 p-2 rounded-lg text-red-600">
                      <Youtube size={20} />
                    </div>
                    <div>
                      <p className="font-bold text-sm leading-tight">{review.title}</p>
                      <p className="text-xs text-zinc-500 mt-1">{review.reviewer}</p>
                      <p className="text-[10px] text-zinc-400 font-mono mt-1">{review.youtube_id}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-zinc-400 hover:text-brand-red"
                      onClick={() => startEditing(review)}
                      disabled={loading}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-zinc-400 hover:text-red-600"
                      onClick={() => handleDelete(review.id)}
                      disabled={loading}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
