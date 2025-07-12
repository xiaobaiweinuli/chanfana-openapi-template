import { SummaryRequest, ApiError } from '../types';
import { stripHtml, truncateText } from '@/utils';

/**
 * AI 服务类
 */
export class AIService {
  private ai: any;

  constructor(ai: any) {
    this.ai = ai;
  }

  /**
   * 生成文章摘要
   */
  async generateSummary(request: SummaryRequest): Promise<string> {
    const { content, maxLength = 150, language = 'zh' } = request;

    if (!content || content.trim().length === 0) {
      throw new ApiError('Content cannot be empty', 400);
    }

    try {
      // 清理 HTML 标签并截断内容
      const cleanContent = stripHtml(content);
      const truncatedContent = truncateText(cleanContent, 2000); // 限制输入长度

      // 使用 Cloudflare Workers AI 的 BART 模型生成摘要
      const response = await this.ai.run('@cf/facebook/bart-large-cnn', {
        input_text: truncatedContent,
        max_length: Math.min(maxLength, 200), // BART 模型的最大输出长度限制
      });

      if (!response || !response.summary) {
        throw new Error('No summary generated');
      }

      let summary = response.summary;

      // 如果是中文内容但生成了英文摘要，尝试翻译
      if (language === 'zh' && this.isEnglishText(summary)) {
        try {
          const translatedSummary = await this.translateToChineseSimple(summary);
          if (translatedSummary) {
            summary = translatedSummary;
          }
        } catch (error) {
          console.warn('Translation failed, using original summary:', error);
        }
      }

      // 确保摘要长度不超过限制
      if (summary.length > maxLength) {
        summary = truncateText(summary, maxLength);
      }

      return summary;
    } catch (error) {
      console.error('AI summary generation error:', error);
      
      // 如果 AI 生成失败，返回简单的摘要
      return this.generateSimpleSummary(content, maxLength);
    }
  }

  /**
   * 生成标签建议
   */
  async generateTags(title: string, content: string): Promise<string[]> {
    try {
      const text = `${title}\n\n${stripHtml(content)}`;
      const truncatedText = truncateText(text, 1000);

      // 使用文本分类模型生成标签
      const response = await this.ai.run('@cf/huggingface/distilbert-sst-2-int8', {
        text: truncatedText,
      });

      // 这里需要根据实际的模型响应格式调整
      // 由于标签生成比较复杂，我们提供一个简化版本
      return this.extractKeywords(text);
    } catch (error) {
      console.error('AI tag generation error:', error);
      return this.extractKeywords(`${title}\n\n${stripHtml(content)}`);
    }
  }

  /**
   * 内容质量分析
   */
  async analyzeContent(title: string, content: string): Promise<{
    score: number;
    readabilityScore: number;
    sentimentScore: number;
    suggestions: string[];
    strengths: string[];
  }> {
    try {
      const text = stripHtml(content);
      const wordCount = text.split(/\s+/).length;
      const sentenceCount = text.split(/[.!?]/).length;
      const avgSentenceLength = wordCount / sentenceCount;

      // 计算可读性分数
      let readabilityScore = 80;
      if (avgSentenceLength > 25) readabilityScore -= 10;
      if (avgSentenceLength > 40) readabilityScore -= 20;
      if (wordCount < 100) readabilityScore -= 15;

      // 使用 AI 进行情感分析
      let sentimentScore = 50; // 默认中性
      try {
        const sentimentResponse = await this.ai.run('@cf/huggingface/distilbert-sst-2-int8', {
          text: truncateText(text, 500),
        });

        if (sentimentResponse && sentimentResponse.label) {
          sentimentScore = sentimentResponse.label === 'POSITIVE' ? 75 : 25;
        }
      } catch (error) {
        console.warn('Sentiment analysis failed:', error);
      }

      // 生成建议和优势
      const suggestions: string[] = [];
      const strengths: string[] = [];

      if (wordCount < 300) {
        suggestions.push('内容较短，建议增加更多详细信息');
      } else if (wordCount > 2000) {
        strengths.push('内容详实丰富');
      } else {
        strengths.push('内容长度适中');
      }

      if (avgSentenceLength > 30) {
        suggestions.push('句子较长，建议分解为更短的句子');
      } else {
        strengths.push('句子长度合适，易于阅读');
      }

      if (title.length < 10) {
        suggestions.push('标题较短，建议增加描述性词汇');
      } else if (title.length > 60) {
        suggestions.push('标题较长，建议简化');
      } else {
        strengths.push('标题长度适中');
      }

      // 计算总体分数
      const score = Math.round((readabilityScore + sentimentScore) / 2);

      return {
        score: Math.max(0, Math.min(100, score)),
        readabilityScore: Math.max(0, Math.min(100, readabilityScore)),
        sentimentScore: Math.max(0, Math.min(100, sentimentScore)),
        suggestions,
        strengths,
      };
    } catch (error) {
      console.error('Content analysis error:', error);
      throw new ApiError('Content analysis failed', 500);
    }
  }

  /**
   * 翻译文本（简化版）
   */
  async translateText(text: string, targetLanguage: string = 'zh'): Promise<string> {
    try {
      // 注意：这里需要使用支持翻译的模型
      // Cloudflare Workers AI 可能需要不同的模型
      const response = await this.ai.run('@cf/meta/m2m100-1.2b', {
        text,
        source_lang: 'en',
        target_lang: targetLanguage,
      });

      return response.translated_text || text;
    } catch (error) {
      console.error('Translation error:', error);
      return text;
    }
  }

  /**
   * 检测文本语言
   */
  private isEnglishText(text: string): boolean {
    // 简单的英文检测：如果大部分字符是 ASCII 字符，认为是英文
    const asciiCount = text.split('').filter(char => char.charCodeAt(0) < 128).length;
    return asciiCount / text.length > 0.8;
  }

  /**
   * 简单的中文翻译（备用方案）
   */
  private async translateToChineseSimple(text: string): Promise<string | null> {
    try {
      return await this.translateText(text, 'zh');
    } catch {
      return null;
    }
  }

  /**
   * 生成简单摘要（备用方案）
   */
  private generateSimpleSummary(content: string, maxLength: number): string {
    const cleanContent = stripHtml(content);
    const sentences = cleanContent.split(/[.!?。！？]/).filter(s => s.trim().length > 10);
    
    if (sentences.length === 0) {
      return '这篇文章探讨了相关主题，提供了有价值的见解和分析。';
    }
    
    // 选择前几个句子作为摘要
    let summary = '';
    for (const sentence of sentences.slice(0, 3)) {
      if (summary.length + sentence.length > maxLength) break;
      summary += sentence.trim() + '。';
    }
    
    if (!summary) {
      summary = sentences[0].trim() + '。';
    }
    
    return summary.length > maxLength 
      ? truncateText(summary, maxLength - 3) + '...'
      : summary;
  }

  /**
   * 提取关键词（备用方案）
   */
  private extractKeywords(text: string): string[] {
    const cleanText = stripHtml(text).toLowerCase();
    
    // 常见的技术关键词
    const techKeywords = [
      'javascript', 'typescript', 'react', 'vue', 'angular', 'nodejs',
      'python', 'java', 'golang', 'rust', 'docker', 'kubernetes',
      'aws', 'azure', 'gcp', 'mongodb', 'postgresql', 'redis',
      '前端', '后端', '全栈', '开发', '编程', '算法', '数据结构',
      '机器学习', '人工智能', 'ai', '深度学习', '数据分析'
    ];
    
    const foundKeywords: string[] = [];
    
    for (const keyword of techKeywords) {
      if (cleanText.includes(keyword) && foundKeywords.length < 5) {
        foundKeywords.push(keyword);
      }
    }
    
    // 如果没有找到技术关键词，返回通用标签
    if (foundKeywords.length === 0) {
      return ['技术', '分享'];
    }
    
    return foundKeywords;
  }
}
